<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("userrole.php");
include_once("function.php");



if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$userRoles = UserRole::find_all();

$errors = array();
$required_fields = array('uploadRole_role') ;

if(isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){

		$theRole = mysql_real_escape_string(htmlspecialchars($_POST['uploadRole_role']));

		$newUR = UserRole::newUserRole($theRole);

		if($newUR->save()){
			redirect_to("settings.php");
		} else {
			die("Cannot create new user role. " . mysql_error());
		}

	} else {
		foreach($errors as $error){
			echo "<p>$error</p></br>";
		}
	}
}

?>

<!-- Load existing values for examination -->
<script>
	var existingRoles = Array();
<?php 
	foreach($userRoles as $userRole){
?>
	existingRoles.push('<?=$userRole->role?>');
<?php
	}
?>
</script>

<div id="registration">
	<form id="userRoleInputForm" action="userRoleInput.php" method="post">
		<fieldset>
			<legend>New Role:</legend>
				<label for="uploadRole_role">Role:</label>
				<input class="text" id="uploadRole_role" type="text" name="uploadRole_role"/></br> 
				<div style="color:red; font-size:12px;" class="validation"></div>
				<input id="submit" name="submit" type="hidden"/></br>
				<input id="userRoleSubmit" name="submit" type="submit"/></br>
		</fieldset>
	</form>
</div>

<script>

	$('#userRoleInputForm input').blur(function(){
		var id = $(this).attr('id');
		var value = $(this).val();
		switch(id){
			case 'uploadRole_role' :
				if(value.length == 0){
					$(this).siblings('div[class="validation"]').text('A role is required.');
				} else if (jQuery.inArray(value, existingRoles) >= 0) {
					$(this).siblings('div[class="validation"]').text('This role already exists.');
				} else {
					$(this).siblings('div[class="validation"]').text('');	
				}
				break;
			default: 
				break;
		}
	});

	$('#addEditRoleBlock').unbind();
	$('#addEditRoleBlock').on("click","#userRoleSubmit", function(e){
		e.preventDefault();
		e.stopPropagation();


//		alert('12');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var role = $('form[id="userRoleInputForm"] #uploadRole_role').val();

		if(role == ''){
			$('form[id="userRoleInputForm"] #uploadRole_role').siblings('div[class="validation"]').text('A role is required.');
			valid += '<p> A role is required. </p>';
		} else if (jQuery.inArray(role, existingRoles) >= 0) {
			$('form[id="userRoleInputForm"] #uploadRole_role').siblings('div[class="validation"]').text('This role already exists.');
			valid += '<p> This role already exists. </p>';
		} else {
			$('form[id="userRoleInputForm"] #uploadRole_role').siblings('div[class="validation"]').text('');	
		}	

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$('#registerErrorMessages').append(errorDisplay);
			$('#registerErrorMessages').removeAttr('style');
			$('#registerErrorMessages').fadeOut(2000);
		} else {
			registrationFormData = $('form[id="userRoleInputForm"]').serialize();
			submitUserRoleData(registrationFormData);
		}
	});

	
	function submitUserRoleData(formData){
		$.ajax({
			type:'POST',
			url: 'uploadRole.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$('#registerErrorMessages').append('<div class="alert alert-success">User Role Added!</div>');
				$('#registerErrorMessages').removeAttr('style');
				$('#registerErrorMessages').fadeOut(2000);
				$('#userRoleListingBlock').load('userRoleListing.php');

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">User Role could not be added!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="userRoleInputForm"]')[0].reset();
			}
		});
	};
</script>