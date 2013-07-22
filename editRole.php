<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$errors = array();
$required_fields = array('editRole_role');



if(isset($_POST['userRoleId'])){
	$userRoleId = $_POST['userRoleId'];     
	$userRole = UserRole::find_by_id($userRoleId);
	$allUserRoles = UserRole::find_all();
?>

<!-- Load existing values for examination -->
<script>
	var currentRole = '<?=$userRole->role?>';
	var existingRoles = Array();
<?php 
	foreach($allUserRoles as $aUserRole){
?>
	existingRoles.push('<?=$aUserRole->role?>');
<?php
	}
?>
</script>

	<!-- <div id="registerErrorMessages"></div> -->
	<form action="editRole.php" method="post" id="editRoleForm">
	<legend>Edit Role</legend>
	<input type="hidden" id="submit2" name="submit"/>
	<input type="hidden" id="id" name="id" value="<?=$userRole->id?>"/>
	<label for="editRole_role">Role:</label>
	<input class="text" id="editRole_role" name="editRole_role" value="<?=$userRole->role?>"/>
	<div style="color:red; font-size:12px;" class="validation"></div>
	<div class='row-fluid'>
		<div class='span6'>
			<input id="editRoleSubmit" type="submit" name="submit" class="btn btn-primary"/>
			<script>

				$('#editRoleForm input').blur(function(e){
					console.log("editRole blur called:");
					var id = $(this).attr('id');
					var role = $(this).val();
					switch(id){
						case 'editRole_role' :
							if(role.length == 0){
								$(this).siblings('div[class="validation"]').text('A role is required.');
							} else if ((jQuery.inArray(role, existingRoles) >= 0) && (currentRole != existingRoles[(jQuery.inArray(role, existingRoles))])) {
								$(this).siblings('div[class="validation"]').text('This role already exists.');
							} else {
								$(this).siblings('div[class="validation"]').text('');	
							}
							break;
						default: 
							break;
					}
				});

				$('#editRoleSubmit').click(function(e){
					e.preventDefault();
					e.stopPropagation();

					console.log("editRole click called:");
					//alert('14');

					var valid = '';
					var errorDisplay = '' ;
					var required = ' is required.';
					var role = $('form[id="editRoleForm"] #editRole_role').val();
					if(role == ''){
						valid += '<p>A role is required.</p>' ;
					} else if ((jQuery.inArray(role, existingRoles) >= 0) && (currentRole != existingRoles[(jQuery.inArray(role, existingRoles))])) {
						valid += '<p>This role already exists.</p>' ;
						$('form[id="editRoleForm"] #editRole_role').siblings('div[class="validation"]').text('This role already exists.');
					} else {
						$('form[id="editRoleForm"] #editRole_role').siblings('div[class="validation"]').text('');	
					}	

					if(valid.length > 0){
						$('div[class="alert alert-error"]').remove();
						$('div[class="alert alert-success"]').remove();
						errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
						$('#registerErrorMessages').append(errorDisplay);
						$('#registerErrorMessages').removeAttr('style');
						$('#registerErrorMessages').fadeOut(2000);
					} else {
						editRoleFormData = $('form[id="editRoleForm"]').serialize();
						submitUserRoleEditData(editRoleFormData);
					}
				});
			</script>
		</div>
		<div class='span6'>
			<button id="cancelRoleSubmit" class='btn btn-primary' type='button'>Cancel</button>
			<script>
				$('#cancelRoleSubmit').click(function(e){
					$("#addEditRoleBlock").load('uploadRole.php');
				});
			</script>
		</div>
	</div>
	</form>	
<?php
} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){
		$id = mysql_real_escape_string(htmlspecialchars($_POST['id']));
		$ur = mysql_real_escape_string(htmlspecialchars($_POST['editRole_role']));


		$newUserRole = UserRole::newUserRole($ur);
		$newUserRole->id = $id;
		if($newUserRole->save()){
			// redirect_to("userRoleListing.php");
		} else {
			die("Cannot register user. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}

?>

<script>
	function submitUserRoleEditData(formData){
		$.ajax({
			type:'POST',
			url: 'editRole.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				console.log('submitUserRoleEditData success called');
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">User Role modified!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#roles").load("userRoleALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				console.log('submitUserRoleEditData error called');
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">User Role could not be modified.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="editRoleForm"]')[0].reset();
			}
		});
	};
</script>