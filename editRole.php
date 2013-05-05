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
$required_fields = array('role');



if(isset($_POST['userRoleId'])){
	$userRoleId = $_POST['userRoleId'];     
	$userRole = UserRole::find_by_id($userRoleId);

	echo "<div id=\"registerErrorMessages\"></div>" ;
	echo "<form action=\"editRole.php\" method=\"post\" id=\"editRoleForm\">" ;
	echo "<legend>Edit Role</legend>" ;
	echo "<input type=\"hidden\" id=\"submit2\" name=\"submit\"/>";
	echo "<input type=\"hidden\" id=\"id\" name=\"id\" value=\"" . $userRole->id . "\"/> </br>";
	echo "Role:<input type=\"text\" id=\"role\" name=\"role\" value=\"" . $userRole->role . "\"/> </br>";
	echo "<input id=\"editRoleSubmit\" type=\"submit\" name=\"submit\" class=\"btn btn-primary\"/>";
	echo "</form>";	

} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){
		$id = mysql_real_escape_string(htmlspecialchars($_POST['id']));
		$ur = mysql_real_escape_string(htmlspecialchars($_POST['role']));


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

<?php
include_once("footer.php");
?>
<script>
	$('#addEditRoleBlock').unbind();
	$('#addEditRoleBlock').on("click","#editRoleSubmit", function(e){

		e.preventDefault();
		e.stopPropagation();

		//alert('14');


		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var theUserRole = $('form[id="editRoleForm"] #role').val();
		if(theUserRole == ''){
			valid += '<p>A role is required.</p>' ;
		}
		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
		} else {
			editRoleFormData = $('form[id="editRoleForm"]').serialize();
			submitUserRoleEditData(editRoleFormData);
		}
	});

	function submitUserRoleEditData(formData){
		$.ajax({
			type:'POST',
			url: 'editRole.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">User Role modified!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#settingsControls").load("userRoleALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
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